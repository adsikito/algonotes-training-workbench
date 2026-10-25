#include <iostream>
#include <vector>
#include <numeric>
void print(const std::vector<long long>& v){for(std::size_t i=0;i<v.size();++i)std::cout<<(i?" ":"")<<v[i];std::cout<<'\n';}
int main(){
 std::vector<long long> a{2,3,5},prefix(3),difference(3);
 std::partial_sum(a.begin(),a.end(),prefix.begin());print(prefix);
 std::adjacent_difference(prefix.begin(),prefix.end(),difference.begin());print(difference);
 std::cout<<std::inner_product(a.begin(),a.end(),a.begin(),0LL)<<' '<<std::accumulate(a.begin(),a.end(),0LL)<<'\n';
}
